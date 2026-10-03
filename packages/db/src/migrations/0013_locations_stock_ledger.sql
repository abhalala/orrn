CREATE TABLE `location` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `location_company_code_unique` ON `location` (`company_id`,`code`);--> statement-breakpoint
CREATE INDEX `location_company_kind_idx` ON `location` (`company_id`,`kind`);--> statement-breakpoint
CREATE INDEX `location_company_server_seq_idx` ON `location` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `stock_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`voucher_type` text NOT NULL,
	`voucher_id` text NOT NULL,
	`line` integer NOT NULL,
	`item_kind` text NOT NULL,
	`item_ref` text NOT NULL,
	`location_id` text,
	`qty_g` integer NOT NULL,
	`posted_at` integer NOT NULL,
	`reversal_of` text,
	`reason` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_ledger_voucher_line_unique` ON `stock_ledger` (`company_id`,`voucher_type`,`voucher_id`,`line`);--> statement-breakpoint
CREATE INDEX `stock_ledger_company_item_idx` ON `stock_ledger` (`company_id`,`item_kind`,`item_ref`);--> statement-breakpoint
CREATE INDEX `stock_ledger_company_location_idx` ON `stock_ledger` (`company_id`,`location_id`,`item_kind`);--> statement-breakpoint
CREATE INDEX `stock_ledger_company_posted_idx` ON `stock_ledger` (`company_id`,`posted_at`,`server_seq`);--> statement-breakpoint
CREATE INDEX `stock_ledger_company_server_seq_idx` ON `stock_ledger` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE INDEX `stock_ledger_company_reversal_idx` ON `stock_ledger` (`company_id`,`reversal_of`);--> statement-breakpoint
ALTER TABLE `bundle` ADD `location_id` text REFERENCES location(id);--> statement-breakpoint
ALTER TABLE `bundle` ADD `die_instance_id` text;--> statement-breakpoint
ALTER TABLE `bundle` ADD `cast_id` text;--> statement-breakpoint
ALTER TABLE `bundle` ADD `sales_order_line_id` text;--> statement-breakpoint
ALTER TABLE `bundle` ADD `kg_per_12ft_milli` integer;--> statement-breakpoint
ALTER TABLE `bundle` ADD `number_style` text;--> statement-breakpoint
CREATE INDEX `bundle_company_location_status_idx` ON `bundle` (`company_id`,`location_id`,`status`);