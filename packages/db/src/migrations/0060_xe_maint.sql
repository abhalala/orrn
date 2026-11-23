-- XE parity lane MAINT (#63 to #68): plant maintenance. Reserved number 0060 (CONTRACTS-W2); the lead renumbers at merge (D30).
CREATE TABLE `maint_asset` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`link_kind` text,
	`link_id` text,
	`make` text,
	`serial_no` text,
	`purchased_on` text,
	`warranty_until` text,
	`location` text,
	`criticality` text DEFAULT 'B' NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `maint_asset_company_code_unique` ON `maint_asset` (`company_id`,lower("code"));--> statement-breakpoint
CREATE UNIQUE INDEX `maint_asset_company_link_unique` ON `maint_asset` (`company_id`,`link_kind`,`link_id`) WHERE "maint_asset"."link_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `maint_asset_company_kind_idx` ON `maint_asset` (`company_id`,`kind`);--> statement-breakpoint
CREATE TABLE `maint_plan` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`asset_id` text NOT NULL,
	`title` text NOT NULL,
	`steps` text,
	`interval_days` integer,
	`interval_hours` integer,
	`base_at` integer NOT NULL,
	`last_work_order_id` text,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `maint_asset`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `maint_plan_company_asset_idx` ON `maint_plan` (`company_id`,`asset_id`);--> statement-breakpoint
CREATE TABLE `maint_reading` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`kind_id` text NOT NULL,
	`value_milli` integer NOT NULL,
	`min_milli` integer,
	`max_milli` integer,
	`flag` text NOT NULL,
	`source` text DEFAULT 'hand' NOT NULL,
	`note` text,
	`work_order_id` text,
	`read_at` integer NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `maint_asset`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`kind_id`) REFERENCES `maint_reading_kind`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `maint_reading_company_asset_idx` ON `maint_reading` (`company_id`,`asset_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `maint_reading_company_flag_idx` ON `maint_reading` (`company_id`,`flag`,`read_at`);--> statement-breakpoint
CREATE TABLE `maint_reading_kind` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`name` text NOT NULL,
	`unit` text NOT NULL,
	`min_milli` integer,
	`max_milli` integer,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `maint_asset`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `maint_reading_kind_company_asset_name_unique` ON `maint_reading_kind` (`company_id`,`asset_id`,lower(trim("name")));--> statement-breakpoint
CREATE TABLE `maint_setting` (
	`company_id` text PRIMARY KEY NOT NULL,
	`labour_rate_paise_per_hour` integer,
	`updated_by` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `maint_wo_spare` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`store_txn_id` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`work_order_id`) REFERENCES `maint_work_order`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_txn_id`) REFERENCES `store_txn`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `maint_wo_spare_company_txn_unique` ON `maint_wo_spare` (`company_id`,`store_txn_id`);--> statement-breakpoint
CREATE INDEX `maint_wo_spare_company_wo_idx` ON `maint_wo_spare` (`company_id`,`work_order_id`);--> statement-breakpoint
CREATE TABLE `maint_work_order` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`number` text NOT NULL,
	`period` text NOT NULL,
	`asset_id` text NOT NULL,
	`kind` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`plan_id` text,
	`downtime_id` text,
	`reading_id` text,
	`priority` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`title` text NOT NULL,
	`assigned_to` text,
	`started_at` integer,
	`finished_at` integer,
	`cause` text,
	`work_done` text,
	`labour_min` integer DEFAULT 0 NOT NULL,
	`cancel_reason` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `maint_asset`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`plan_id`) REFERENCES `maint_plan`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`downtime_id`) REFERENCES `press_downtime`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assigned_to`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `maint_wo_company_number_unique` ON `maint_work_order` (`company_id`,`period`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `maint_wo_company_downtime_unique` ON `maint_work_order` (`company_id`,`downtime_id`) WHERE "maint_work_order"."downtime_id" IS NOT NULL AND "maint_work_order"."status" <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX `maint_wo_company_reading_unique` ON `maint_work_order` (`company_id`,`reading_id`) WHERE "maint_work_order"."reading_id" IS NOT NULL AND "maint_work_order"."status" <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX `maint_wo_company_plan_live_unique` ON `maint_work_order` (`company_id`,`plan_id`) WHERE "maint_work_order"."plan_id" IS NOT NULL AND "maint_work_order"."status" IN ('open', 'in_progress', 'waiting_spares');--> statement-breakpoint
CREATE INDEX `maint_wo_company_status_idx` ON `maint_work_order` (`company_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `maint_wo_company_asset_idx` ON `maint_work_order` (`company_id`,`asset_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `press_run_company_line_end_idx` ON `press_run` (`company_id`,`press_line_id`,coalesce("stopped_at", 9007199254740991));