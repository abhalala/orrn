CREATE TABLE `legacy_bundle_map` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`legacy_id` text NOT NULL,
	`bundle_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bundle_id`) REFERENCES `bundle`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legacy_bundle_map_company_legacy_unique` ON `legacy_bundle_map` (`company_id`,`legacy_id`);--> statement-breakpoint
CREATE INDEX `legacy_bundle_map_company_bundle_idx` ON `legacy_bundle_map` (`company_id`,`bundle_id`);--> statement-breakpoint
CREATE TABLE `doc_series` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`doc_type` text NOT NULL,
	`period` text NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `doc_series_company_type_period_unique` ON `doc_series` (`company_id`,`doc_type`,`period`);