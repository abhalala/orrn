-- W2-FD-S (FP-FD-01..20): foundry server on the hub (D31). Additive only: melt_reading (furnace readings,
-- FOUNDRY_SIMULATOR seam), melt alloy_reason + corrects_melt_id, melt_output billet length + diameter,
-- spectro_result source / entry_reason / client_request_id, cast tail_reason_code_id.
CREATE TABLE `melt_reading` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`melt_id` text NOT NULL,
	`furnace_id` text,
	`kind` text NOT NULL,
	`value_x10` integer NOT NULL,
	`read_at` integer NOT NULL,
	`source` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`melt_id`) REFERENCES `melt`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`furnace_id`) REFERENCES `furnace`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `melt_reading_company_melt_kind_at_unique` ON `melt_reading` (`company_id`,`melt_id`,`kind`,`read_at`,`source`);--> statement-breakpoint
CREATE INDEX `melt_reading_company_server_seq_idx` ON `melt_reading` (`company_id`,`server_seq`);--> statement-breakpoint
ALTER TABLE `cast` ADD `tail_reason_code_id` text;--> statement-breakpoint
ALTER TABLE `melt` ADD `alloy_reason` text;--> statement-breakpoint
ALTER TABLE `melt` ADD `corrects_melt_id` text;--> statement-breakpoint
ALTER TABLE `melt_output` ADD `billet_length_mm` integer;--> statement-breakpoint
ALTER TABLE `melt_output` ADD `diameter_mm` integer;--> statement-breakpoint
ALTER TABLE `spectro_result` ADD `source` text DEFAULT 'file' NOT NULL;--> statement-breakpoint
ALTER TABLE `spectro_result` ADD `entry_reason` text;--> statement-breakpoint
ALTER TABLE `spectro_result` ADD `client_request_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `spectro_result_company_request_unique` ON `spectro_result` (`company_id`,`client_request_id`) WHERE "spectro_result"."client_request_id" is not null;