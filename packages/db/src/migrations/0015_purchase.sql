CREATE TABLE `dc_note` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`number` text NOT NULL,
	`period` text NOT NULL,
	`lot_id` text NOT NULL,
	`type` text NOT NULL,
	`reason` text NOT NULL,
	`kg_diff_g` integer DEFAULT 0 NOT NULL,
	`bori_deduction_g` integer DEFAULT 0 NOT NULL,
	`amount_paise` integer DEFAULT 0 NOT NULL,
	`tolerance_bp` integer NOT NULL,
	`note` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`approval_id` text,
	`decided_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lot_id`) REFERENCES `purchase_lot`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dc_note_company_number_unique` ON `dc_note` (`company_id`,`period`,`number`);--> statement-breakpoint
CREATE INDEX `dc_note_company_lot_idx` ON `dc_note` (`company_id`,`lot_id`);--> statement-breakpoint
CREATE INDEX `dc_note_company_status_idx` ON `dc_note` (`company_id`,`status`);--> statement-breakpoint
CREATE INDEX `dc_note_company_server_seq_idx` ON `dc_note` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `dc_note_pending_lot_unique` ON `dc_note` (`lot_id`) WHERE "dc_note"."status" = 'pending';--> statement-breakpoint
CREATE TABLE `purchase_lot` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`number` text NOT NULL,
	`period` text NOT NULL,
	`vendor_id` text NOT NULL,
	`lot_date` text NOT NULL,
	`origin` text,
	`scrap_item_id` text NOT NULL,
	`scrap_grade_id` text NOT NULL,
	`party_kg_g` integer NOT NULL,
	`fc_kg_g` integer,
	`rate_paise` integer NOT NULL,
	`dross_bp` integer,
	`bill_book` text DEFAULT 'main' NOT NULL,
	`party_bill_no` text,
	`vehicle_no` text,
	`photo_urls` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'booking' NOT NULL,
	`location_id` text,
	`ok_at` integer,
	`ok_by` text,
	`cancelled_at` integer,
	`cancelled_by` text,
	`cancel_reason` text,
	`notes` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendor`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scrap_item_id`) REFERENCES `scrap_item`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scrap_grade_id`) REFERENCES `scrap_grade`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`ok_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cancelled_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_lot_company_number_unique` ON `purchase_lot` (`company_id`,`period`,`number`);--> statement-breakpoint
CREATE INDEX `purchase_lot_company_date_idx` ON `purchase_lot` (`company_id`,`lot_date`);--> statement-breakpoint
CREATE INDEX `purchase_lot_company_vendor_idx` ON `purchase_lot` (`company_id`,`vendor_id`,`lot_date`);--> statement-breakpoint
CREATE INDEX `purchase_lot_company_status_idx` ON `purchase_lot` (`company_id`,`status`);--> statement-breakpoint
CREATE INDEX `purchase_lot_company_server_seq_idx` ON `purchase_lot` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `scrap_grade` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`code` text NOT NULL,
	`name` text,
	`expected_recovery_bp` integer,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scrap_grade_company_code_unique` ON `scrap_grade` (`company_id`,`code`);--> statement-breakpoint
CREATE INDEX `scrap_grade_company_server_seq_idx` ON `scrap_grade` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `scrap_item` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`expected_recovery_bp` integer,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scrap_item_company_name_key_unique` ON `scrap_item` (`company_id`,`name_key`);--> statement-breakpoint
CREATE INDEX `scrap_item_company_server_seq_idx` ON `scrap_item` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `vendor` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`gstin` text,
	`phone` text,
	`city` text,
	`status` text DEFAULT 'active' NOT NULL,
	`merged_into_id` text,
	`notes` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_company_name_key_unique` ON `vendor` (`company_id`,`name_key`) WHERE "vendor"."status" <> 'merged';--> statement-breakpoint
CREATE INDEX `vendor_company_status_idx` ON `vendor` (`company_id`,`status`);--> statement-breakpoint
CREATE INDEX `vendor_company_server_seq_idx` ON `vendor` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `vendor_alias` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`vendor_id` text NOT NULL,
	`alias` text NOT NULL,
	`alias_key` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendor`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_alias_company_key_unique` ON `vendor_alias` (`company_id`,`alias_key`);--> statement-breakpoint
CREATE INDEX `vendor_alias_vendor_idx` ON `vendor_alias` (`company_id`,`vendor_id`);--> statement-breakpoint
CREATE INDEX `vendor_alias_company_server_seq_idx` ON `vendor_alias` (`company_id`,`server_seq`);