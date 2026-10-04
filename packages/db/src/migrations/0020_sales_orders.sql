CREATE TABLE `sales_order` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`number` text NOT NULL,
	`customer_id` text NOT NULL,
	`po_number` text,
	`order_date` text NOT NULL,
	`status` text DEFAULT 'booking' NOT NULL,
	`note` text,
	`line_seq` integer DEFAULT 0 NOT NULL,
	`status_changed_at` integer,
	`status_changed_by` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customer`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`status_changed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_order_company_number_unique` ON `sales_order` (`company_id`,`number`);--> statement-breakpoint
CREATE INDEX `sales_order_company_customer_status_idx` ON `sales_order` (`company_id`,`customer_id`,`status`);--> statement-breakpoint
CREATE INDEX `sales_order_company_status_date_idx` ON `sales_order` (`company_id`,`status`,`order_date`);--> statement-breakpoint
CREATE INDEX `sales_order_company_server_seq_idx` ON `sales_order` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `sales_order_line` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`sales_order_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`die_id` text NOT NULL,
	`kg_per_12ft_milli` integer,
	`cut_length_mm` integer NOT NULL,
	`pcs` integer,
	`kg_g` integer NOT NULL,
	`finish` text,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sales_order_id`) REFERENCES `sales_order`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`die_id`) REFERENCES `die`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_order_line_order_no_unique` ON `sales_order_line` (`sales_order_id`,`line_no`);--> statement-breakpoint
CREATE INDEX `sales_order_line_company_order_idx` ON `sales_order_line` (`company_id`,`sales_order_id`);--> statement-breakpoint
CREATE INDEX `sales_order_line_company_die_idx` ON `sales_order_line` (`company_id`,`die_id`);--> statement-breakpoint
CREATE INDEX `sales_order_line_company_server_seq_idx` ON `sales_order_line` (`company_id`,`server_seq`);--> statement-breakpoint
ALTER TABLE `customer` ADD `kg_tolerance_bp` integer;--> statement-breakpoint
ALTER TABLE `dispatch` ADD `vehicle_no` text;--> statement-breakpoint
ALTER TABLE `dispatch` ADD `driver_name` text;--> statement-breakpoint
ALTER TABLE `dispatch` ADD `driver_phone` text;--> statement-breakpoint
ALTER TABLE `dispatch` ADD `transporter` text;--> statement-breakpoint
ALTER TABLE `dispatch` ADD `pl_number` text;--> statement-breakpoint
ALTER TABLE `dispatch` ADD `invoice_number` text;--> statement-breakpoint
ALTER TABLE `dispatch` ADD `invoice_date` text;--> statement-breakpoint
CREATE UNIQUE INDEX `dispatch_company_pl_number_unique` ON `dispatch` (`company_id`,`pl_number`);--> statement-breakpoint
ALTER TABLE `dispatch_item` ADD `sales_order_line_id` text;--> statement-breakpoint
CREATE INDEX `dispatch_item_company_so_line_idx` ON `dispatch_item` (`company_id`,`sales_order_line_id`);--> statement-breakpoint
CREATE INDEX `bundle_company_so_line_idx` ON `bundle` (`company_id`,`sales_order_line_id`);