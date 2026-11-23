CREATE TABLE `store_indent` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`number` text NOT NULL,
	`period` text NOT NULL,
	`department` text NOT NULL,
	`needed_by` text,
	`reason` text,
	`status` text DEFAULT 'open' NOT NULL,
	`source` text,
	`decided_by` text,
	`decided_at` integer,
	`decision_note` text,
	`po_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_indent_company_number_unique` ON `store_indent` (`company_id`,`period`,`number`);--> statement-breakpoint
CREATE INDEX `store_indent_company_status_idx` ON `store_indent` (`company_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `store_indent_line` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`indent_id` text NOT NULL,
	`line` integer NOT NULL,
	`item_id` text NOT NULL,
	`qty_milli` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`indent_id`) REFERENCES `store_indent`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `store_item`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_indent_line_unique` ON `store_indent_line` (`indent_id`,`line`);--> statement-breakpoint
CREATE INDEX `store_indent_line_company_item_idx` ON `store_indent_line` (`company_id`,`item_id`);--> statement-breakpoint
CREATE TABLE `store_po` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`number` text NOT NULL,
	`period` text NOT NULL,
	`vendor_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`delivery_date` text,
	`terms` text,
	`note` text,
	`indent_id` text,
	`issued_by` text,
	`issued_at` integer,
	`closed_by` text,
	`closed_at` integer,
	`close_note` text,
	`cancelled_by` text,
	`cancelled_at` integer,
	`cancel_reason` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendor`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`issued_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`closed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cancelled_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_po_company_number_unique` ON `store_po` (`company_id`,`period`,`number`);--> statement-breakpoint
CREATE INDEX `store_po_company_status_idx` ON `store_po` (`company_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `store_po_company_vendor_idx` ON `store_po` (`company_id`,`vendor_id`);--> statement-breakpoint
CREATE TABLE `store_po_line` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`po_id` text NOT NULL,
	`line` integer NOT NULL,
	`item_id` text NOT NULL,
	`qty_milli` integer NOT NULL,
	`rate_paise` integer NOT NULL,
	`gst_bp` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`po_id`) REFERENCES `store_po`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `store_item`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_po_line_unique` ON `store_po_line` (`po_id`,`line`);--> statement-breakpoint
CREATE INDEX `store_po_line_company_item_idx` ON `store_po_line` (`company_id`,`item_id`);--> statement-breakpoint
ALTER TABLE `store_item` ADD `min_milli` integer;--> statement-breakpoint
ALTER TABLE `store_item` ADD `reorder_milli` integer;--> statement-breakpoint
ALTER TABLE `store_txn` ADD `rate_paise` integer;--> statement-breakpoint
ALTER TABLE `store_txn` ADD `value_paise` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `store_txn` ADD `po_line_id` text;--> statement-breakpoint
ALTER TABLE `store_txn` ADD `rejected_milli` integer;--> statement-breakpoint
CREATE INDEX `store_txn_company_po_line_idx` ON `store_txn` (`company_id`,`po_line_id`);--> statement-breakpoint
CREATE TABLE `store_opening_rate` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`item_id` text NOT NULL,
	`rate_paise` integer NOT NULL,
	`qty_milli` integer NOT NULL,
	`value_paise` integer NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `store_item`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `store_opening_rate_company_item_idx` ON `store_opening_rate` (`company_id`,`item_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `store_txn` ADD `rated_milli` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `store_txn` ADD `rate_pending` integer DEFAULT false NOT NULL;