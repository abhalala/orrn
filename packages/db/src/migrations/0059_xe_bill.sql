-- XE-BILL (lane BILL, CONTRACTS migration 0059): tax invoice, credit note, GST settings, HSN, payments received,
-- e-invoice / e-way bill state. Additive: nine new tables, no existing table changed. Both modules (billing,
-- einvoice) are opt-in, so nothing here is read for a plant that has not named them.

CREATE TABLE `billing_event` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`invoice_id` text,
	`action` text NOT NULL,
	`outcome` text NOT NULL,
	`code` text,
	`message` text,
	`at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `billing_event_company_invoice_idx` ON `billing_event` (`company_id`,`invoice_id`,`at`);--> statement-breakpoint
CREATE TABLE `billing_settings` (
	`company_id` text PRIMARY KEY NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`state_code` text,
	`pincode` text,
	`place` text,
	`trade_name` text,
	`signatory` text,
	`terms` text,
	`einvoice_from` text,
	`tally_ledgers` text,
	`updated_by` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `customer_gst` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`tax_category` text DEFAULT 'regular' NOT NULL,
	`state_code` text,
	`pincode` text,
	`place` text,
	`place_of_supply` text,
	`ship_to_kind` text DEFAULT 'same' NOT NULL,
	`ship_to_customer_id` text,
	`ship_to_name` text,
	`ship_to_gstin` text,
	`ship_to_address` text,
	`ship_to_place` text,
	`ship_to_state_code` text,
	`ship_to_pincode` text,
	`distance_km` integer,
	`updated_by` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customer`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ship_to_customer_id`) REFERENCES `customer`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_gst_company_customer_unique` ON `customer_gst` (`company_id`,`customer_id`);--> statement-breakpoint
CREATE TABLE `gst_hsn` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`code` text NOT NULL,
	`description` text NOT NULL,
	`rate_bp` integer NOT NULL,
	`uqc` text DEFAULT 'KGS' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gst_hsn_company_code_unique` ON `gst_hsn` (`company_id`,`code`);--> statement-breakpoint
CREATE TABLE `gst_section_hsn` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`die_id` text NOT NULL,
	`hsn_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`die_id`) REFERENCES `die`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`hsn_id`) REFERENCES `gst_hsn`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gst_section_hsn_company_die_unique` ON `gst_section_hsn` (`company_id`,`die_id`);--> statement-breakpoint
CREATE TABLE `invoice` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`kind` text DEFAULT 'invoice' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`period` text,
	`seq` integer,
	`number` text,
	`invoice_date` text,
	`customer_id` text NOT NULL,
	`against_invoice_id` text,
	`note_reason` text,
	`reason` text,
	`supply_type` text NOT NULL,
	`place_of_supply` text NOT NULL,
	`weight_g` integer DEFAULT 0 NOT NULL,
	`taxable_paise` integer DEFAULT 0 NOT NULL,
	`cgst_paise` integer DEFAULT 0 NOT NULL,
	`sgst_paise` integer DEFAULT 0 NOT NULL,
	`igst_paise` integer DEFAULT 0 NOT NULL,
	`round_off_paise` integer DEFAULT 0 NOT NULL,
	`total_paise` integer DEFAULT 0 NOT NULL,
	`snapshot` text NOT NULL,
	`needs_irn` integer DEFAULT false NOT NULL,
	`irn_status` text DEFAULT 'none' NOT NULL,
	`irn` text,
	`ack_no` text,
	`ack_dt` text,
	`signed_invoice` text,
	`signed_qr_code` text,
	`irn_attempts` integer DEFAULT 0 NOT NULL,
	`irn_next_try_at` integer,
	`irn_call_at` integer,
	`irn_unknown_since` integer,
	`irn_error` text,
	`irn_generated_at` integer,
	`irn_cancelled_at` integer,
	`ewb_status` text DEFAULT 'none' NOT NULL,
	`ewb_no` text,
	`ewb_date` integer,
	`ewb_valid_until` integer,
	`distance_km` integer,
	`vehicle_no` text,
	`cancel_reason` text,
	`cancel_approval_id` text,
	`cancelled_by` text,
	`cancelled_at` integer,
	`created_by` text,
	`issued_by` text,
	`issued_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customer`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cancelled_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`issued_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_company_kind_period_seq_unique` ON `invoice` (`company_id`,`kind`,`period`,`seq`);--> statement-breakpoint
CREATE INDEX `invoice_company_customer_idx` ON `invoice` (`company_id`,`customer_id`);--> statement-breakpoint
CREATE INDEX `invoice_company_status_idx` ON `invoice` (`company_id`,`status`);--> statement-breakpoint
CREATE INDEX `invoice_company_against_idx` ON `invoice` (`company_id`,`against_invoice_id`);--> statement-breakpoint
CREATE INDEX `invoice_irn_retry_idx` ON `invoice` (`irn_status`,`irn_next_try_at`);--> statement-breakpoint
CREATE TABLE `invoice_source` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`packing_list_id` text NOT NULL,
	`pl_code` text NOT NULL,
	`pl_revision` integer NOT NULL,
	`dispatch_id` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`packing_list_id`) REFERENCES `packing_list`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`dispatch_id`) REFERENCES `dispatch`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `invoice_source_company_invoice_idx` ON `invoice_source` (`company_id`,`invoice_id`);--> statement-breakpoint
CREATE INDEX `invoice_source_company_pl_idx` ON `invoice_source` (`company_id`,`packing_list_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_source_live_dispatch_unique` ON `invoice_source` (`company_id`,`dispatch_id`) WHERE "invoice_source"."active" = 1;--> statement-breakpoint
CREATE TABLE `payment` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`period` text NOT NULL,
	`seq` integer NOT NULL,
	`number` text NOT NULL,
	`customer_id` text NOT NULL,
	`received_on` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`mode` text NOT NULL,
	`reference` text,
	`note` text,
	`status` text DEFAULT 'active' NOT NULL,
	`void_reason` text,
	`voided_by` text,
	`voided_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customer`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`voided_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_company_period_seq_unique` ON `payment` (`company_id`,`period`,`seq`);--> statement-breakpoint
CREATE INDEX `payment_company_customer_idx` ON `payment` (`company_id`,`customer_id`);--> statement-breakpoint
CREATE TABLE `payment_allocation` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`payment_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payment_id`) REFERENCES `payment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `payment_allocation_company_invoice_idx` ON `payment_allocation` (`company_id`,`invoice_id`);--> statement-breakpoint
CREATE INDEX `payment_allocation_company_payment_idx` ON `payment_allocation` (`company_id`,`payment_id`);