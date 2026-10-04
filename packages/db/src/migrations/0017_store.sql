CREATE TABLE `store_item` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`unit` text NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_item_company_name_key_unique` ON `store_item` (`company_id`,`name_key`);--> statement-breakpoint
CREATE INDEX `store_item_company_server_seq_idx` ON `store_item` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `store_txn` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`kind` text NOT NULL,
	`number` text NOT NULL,
	`period` text NOT NULL,
	`item_id` text NOT NULL,
	`qty_milli` integer NOT NULL,
	`location_id` text NOT NULL,
	`purpose` text,
	`ref_id` text,
	`grn_ref` text,
	`exchange_id` text,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `store_item`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_txn_company_number_unique` ON `store_txn` (`company_id`,`kind`,`period`,`number`);--> statement-breakpoint
CREATE INDEX `store_txn_company_item_idx` ON `store_txn` (`company_id`,`item_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `store_txn_company_created_idx` ON `store_txn` (`company_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `store_txn_company_exchange_idx` ON `store_txn` (`company_id`,`exchange_id`);--> statement-breakpoint
CREATE INDEX `store_txn_company_server_seq_idx` ON `store_txn` (`company_id`,`server_seq`);