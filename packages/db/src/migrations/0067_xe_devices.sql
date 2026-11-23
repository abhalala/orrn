CREATE TABLE `device_reading` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`device_id` text,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`seq` integer,
	`epoch` text,
	`simulated` integer DEFAULT false NOT NULL,
	`sampled_at` integer NOT NULL,
	`received_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`skew_ms` integer,
	`time_unconfirmed` integer DEFAULT false NOT NULL,
	`ticket_no` text,
	`vehicle_no` text,
	`gross_g` integer,
	`tare_g` integer,
	`net_g` integer,
	`sample_code` text,
	`values_json` text DEFAULT '{}' NOT NULL,
	`imported_by` text,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `plant_device`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`imported_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_reading_company_dedupe_unique` ON `device_reading` (`company_id`,`dedupe_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `device_reading_device_ticket_unique` ON `device_reading` (`company_id`,`device_id`,`ticket_no`) WHERE "device_reading"."kind" = 'weighbridge' AND "device_reading"."device_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `device_reading_company_kind_at_idx` ON `device_reading` (`company_id`,`kind`,`sampled_at`);--> statement-breakpoint
CREATE INDEX `device_reading_company_vehicle_idx` ON `device_reading` (`company_id`,`vehicle_no`,`sampled_at`);--> statement-breakpoint
CREATE INDEX `device_reading_company_sample_idx` ON `device_reading` (`company_id`,`sample_code`);--> statement-breakpoint
CREATE INDEX `device_reading_device_at_idx` ON `device_reading` (`device_id`,`sampled_at`);--> statement-breakpoint
CREATE TABLE `device_reading_use` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`reading_id` text,
	`subject_type` text NOT NULL,
	`subject_id` text,
	`bridge_g` integer,
	`typed_g` integer,
	`diff_g` integer,
	`allowed_g` integer,
	`flagged` integer DEFAULT false NOT NULL,
	`reason` text,
	`qa_check_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`voided_by` text,
	`voided_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reading_id`) REFERENCES `device_reading`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`qa_check_id`) REFERENCES `qa_check`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`voided_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_reading_use_live_reading_unique` ON `device_reading_use` (`company_id`,`reading_id`) WHERE "device_reading_use"."reading_id" IS NOT NULL AND "device_reading_use"."voided_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `device_reading_use_live_weigh_unique` ON `device_reading_use` (`company_id`,`subject_type`,`subject_id`) WHERE "device_reading_use"."subject_type" IN ('purchase_lot', 'dispatch') AND "device_reading_use"."voided_at" IS NULL;--> statement-breakpoint
CREATE INDEX `device_reading_use_company_subject_idx` ON `device_reading_use` (`company_id`,`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `device_reading_use_company_flagged_idx` ON `device_reading_use` (`company_id`,`flagged`,`created_at`);--> statement-breakpoint
CREATE TABLE `plant_device` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`deployment_id` text,
	`code` text NOT NULL,
	`label` text NOT NULL,
	`kind` text NOT NULL,
	`protocol` text NOT NULL,
	`simulated` integer DEFAULT false NOT NULL,
	`config_json` text,
	`heartbeat_sec` integer DEFAULT 60 NOT NULL,
	`token_hash` text,
	`token_hint` text,
	`token_version` integer DEFAULT 1 NOT NULL,
	`enrolled_by` text,
	`enrolled_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`revoked_by` text,
	`revoked_at` integer,
	`revoke_reason` text,
	`last_seen_at` integer,
	`last_seq` integer,
	`last_epoch` text,
	`last_skew_ms` integer,
	`buffered` integer,
	`link_state` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deployment_id`) REFERENCES `spool_deployment`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`enrolled_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`revoked_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plant_device_company_code_unique` ON `plant_device` (`company_id`,`code`);--> statement-breakpoint
CREATE INDEX `plant_device_company_kind_idx` ON `plant_device` (`company_id`,`kind`);--> statement-breakpoint
CREATE INDEX `plant_device_deployment_idx` ON `plant_device` (`deployment_id`);