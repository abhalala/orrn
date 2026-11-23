-- XE-PRICE (lane PRICE): price master (price_rate), quote + quote_line, proforma, works_order, enquiry,
-- and sales_order_line.price_breakup. Additive only. Reserved as 0058; renumbered to 0059 at merge (QA took 0058).

CREATE TABLE `enquiry` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`customer_id` text,
	`prospect_name` text,
	`contact` text,
	`die_id` text,
	`section_text` text,
	`kg_g` integer,
	`follow_up_date` text,
	`status` text DEFAULT 'open' NOT NULL,
	`quote_id` text,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customer`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`die_id`) REFERENCES `die`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`quote_id`) REFERENCES `quote`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `enquiry_company_status_follow_idx` ON `enquiry` (`company_id`,`status`,`follow_up_date`);--> statement-breakpoint
CREATE TABLE `price_rate` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`paise` integer NOT NULL,
	`effective_from` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`detail` text,
	`reason` text,
	`approval_id` text,
	`decided_by` text,
	`decided_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approval_id`) REFERENCES `approval`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`decided_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `price_rate_company_kind_key_idx` ON `price_rate` (`company_id`,`kind`,`key`,`effective_from`);--> statement-breakpoint
CREATE INDEX `price_rate_company_status_idx` ON `price_rate` (`company_id`,`status`);--> statement-breakpoint
CREATE TABLE `proforma` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`period` text NOT NULL,
	`number` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customer`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proforma_company_period_number_unique` ON `proforma` (`company_id`,`period`,`number`);--> statement-breakpoint
CREATE INDEX `proforma_company_source_idx` ON `proforma` (`company_id`,`source_kind`,`source_id`);--> statement-breakpoint
CREATE TABLE `quote` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`period` text NOT NULL,
	`number` text NOT NULL,
	`customer_id` text NOT NULL,
	`quote_date` text NOT NULL,
	`valid_until` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`note` text,
	`charges` text,
	`sales_order_id` text,
	`enquiry_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customer`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sales_order_id`) REFERENCES `sales_order`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quote_company_period_number_unique` ON `quote` (`company_id`,`period`,`number`);--> statement-breakpoint
CREATE INDEX `quote_company_status_idx` ON `quote` (`company_id`,`status`,`quote_date`);--> statement-breakpoint
CREATE INDEX `quote_company_customer_idx` ON `quote` (`company_id`,`customer_id`);--> statement-breakpoint
CREATE TABLE `quote_line` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`quote_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`die_id` text NOT NULL,
	`cut_length_mm` integer NOT NULL,
	`pcs` integer,
	`kg_g` integer NOT NULL,
	`finish` text,
	`alloy` text,
	`temper` text,
	`rate_paise` integer NOT NULL,
	`price_breakup` text,
	`note` text,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`quote_id`) REFERENCES `quote`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`die_id`) REFERENCES `die`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quote_line_quote_no_unique` ON `quote_line` (`quote_id`,`line_no`);--> statement-breakpoint
CREATE INDEX `quote_line_company_quote_idx` ON `quote_line` (`company_id`,`quote_id`);--> statement-breakpoint
CREATE TABLE `works_order` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`sales_order_id` text NOT NULL,
	`period` text NOT NULL,
	`number` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sales_order_id`) REFERENCES `sales_order`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `works_order_company_order_unique` ON `works_order` (`company_id`,`sales_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `works_order_company_period_number_unique` ON `works_order` (`company_id`,`period`,`number`);--> statement-breakpoint
ALTER TABLE `sales_order_line` ADD `price_breakup` text;