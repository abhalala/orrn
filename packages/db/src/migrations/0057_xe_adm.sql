-- XE parity lane ADM (rows 20, 57-60, 75, 76, 80): plant masters, bank accounts, tooling items and inspections,
-- die copy cost and inspection state, document register; nullable columns on die, dispatch, sales_order_line, membership.
-- Additive only. Numbered 0057 by the wave 1 contract (0055 QA, 0056 REG); the lead orders the journal.

CREATE TABLE `die_copy_extra` (
	`die_instance_id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`cost_paise` integer,
	`inspection` text,
	`inspection_id` text,
	`updated_by` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`die_instance_id`) REFERENCES `die_instance`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `die_copy_extra_company_idx` ON `die_copy_extra` (`company_id`);--> statement-breakpoint
CREATE TABLE `plant_bank_account` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`bank_name` text NOT NULL,
	`branch` text,
	`account_name` text NOT NULL,
	`account_no` text NOT NULL,
	`ifsc` text NOT NULL,
	`note` text,
	`is_default` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `plant_bank_account_company_idx` ON `plant_bank_account` (`company_id`,`active`);--> statement-breakpoint
CREATE UNIQUE INDEX `plant_bank_account_one_default` ON `plant_bank_account` (`company_id`) WHERE "plant_bank_account"."is_default" = 1 and "plant_bank_account"."active" = 1;--> statement-breakpoint
CREATE TABLE `plant_document` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`version` text,
	`review_on` text,
	`notes` text,
	`r2_key` text,
	`filename` text,
	`bytes` integer,
	`content_type` text,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `plant_document_company_idx` ON `plant_document` (`company_id`,`active`,`review_on`);--> statement-breakpoint
CREATE INDEX `plant_document_r2_key_idx` ON `plant_document` (`r2_key`);--> statement-breakpoint
CREATE TABLE `plant_master` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`expected_life_g` integer,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `plant_master_company_kind_idx` ON `plant_master` (`company_id`,`kind`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `plant_master_live_name_unique` ON `plant_master` (`company_id`,`kind`,lower(trim("name"))) WHERE "plant_master"."active" = 1;--> statement-breakpoint
CREATE TABLE `tool_inspection` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`result` text NOT NULL,
	`notes` text,
	`inspected_by` text,
	`inspected_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inspected_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tool_inspection_company_subject_idx` ON `tool_inspection` (`company_id`,`subject_type`,`subject_id`,`inspected_at`);--> statement-breakpoint
CREATE TABLE `tooling_item` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`type` text NOT NULL,
	`code` text NOT NULL,
	`size` text,
	`location` text,
	`status` text DEFAULT 'awaiting_inspection' NOT NULL,
	`maker_name` text,
	`received_at` integer,
	`notes` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tooling_item_company_type_status_idx` ON `tooling_item` (`company_id`,`type`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `tooling_item_live_code_unique` ON `tooling_item` (`company_id`,lower(trim("code"))) WHERE "tooling_item"."status" != 'retired';--> statement-breakpoint
ALTER TABLE `die` ADD `die_category_id` text;--> statement-breakpoint
ALTER TABLE `dispatch` ADD `packing_mode_id` text;--> statement-breakpoint
ALTER TABLE `sales_order_line` ADD `packing_mode_id` text;--> statement-breakpoint
ALTER TABLE `membership` ADD `department_id` text;--> statement-breakpoint
ALTER TABLE `membership` ADD `designation_id` text;