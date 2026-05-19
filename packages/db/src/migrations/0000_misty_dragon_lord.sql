CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text,
	`actor_id` text,
	`impersonator_id` text,
	`action` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text,
	`meta` text DEFAULT '{}' NOT NULL,
	`at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`impersonator_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_company_at_idx` ON `audit_log` (`company_id`,`at`);--> statement-breakpoint
CREATE INDEX `audit_actor_at_idx` ON `audit_log` (`actor_id`,`at`);--> statement-breakpoint
CREATE INDEX `audit_subject_idx` ON `audit_log` (`company_id`,`subject_type`,`subject_id`);--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `die` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`series` text NOT NULL,
	`section_code` text NOT NULL,
	`name` text,
	`dimensions` text DEFAULT '{}' NOT NULL,
	`weight_min_g` integer NOT NULL,
	`weight_max_g` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `die_company_series_section_unique` ON `die` (`company_id`,`series`,`section_code`);--> statement-breakpoint
CREATE INDEX `die_company_status_idx` ON `die` (`company_id`,`status`);--> statement-breakpoint
CREATE INDEX `die_company_server_seq_idx` ON `die` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `customer` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`email` text,
	`billing_address` text,
	`shipping_address` text,
	`tax_id` text,
	`notes` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `customer_company_name_idx` ON `customer` (`company_id`,`name`);--> statement-breakpoint
CREATE INDEX `customer_company_server_seq_idx` ON `customer` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `dispatch` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`code` text NOT NULL,
	`customer_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`ship_date` integer,
	`notes` text,
	`created_by` text,
	`completed_by` text,
	`completed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customer`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`completed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dispatch_company_code_unique` ON `dispatch` (`company_id`,`code`);--> statement-breakpoint
CREATE INDEX `dispatch_company_status_idx` ON `dispatch` (`company_id`,`status`);--> statement-breakpoint
CREATE INDEX `dispatch_company_server_seq_idx` ON `dispatch` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `dispatch_item` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`dispatch_id` text NOT NULL,
	`bundle_id` text NOT NULL,
	`added_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dispatch_id`) REFERENCES `dispatch`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bundle_id`) REFERENCES `bundle`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dispatch_item_dispatch_bundle_unique` ON `dispatch_item` (`dispatch_id`,`bundle_id`);--> statement-breakpoint
CREATE INDEX `dispatch_item_company_dispatch_idx` ON `dispatch_item` (`company_id`,`dispatch_id`);--> statement-breakpoint
CREATE TABLE `bundle` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`group_id` text NOT NULL,
	`die_id` text NOT NULL,
	`serial` text NOT NULL,
	`quantity` integer NOT NULL,
	`weight_g` integer NOT NULL,
	`length_mm` integer NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`current_dispatch_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `bundle_group`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`die_id`) REFERENCES `die`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bundle_company_serial_unique` ON `bundle` (`company_id`,`serial`);--> statement-breakpoint
CREATE INDEX `bundle_company_status_idx` ON `bundle` (`company_id`,`status`);--> statement-breakpoint
CREATE INDEX `bundle_company_die_idx` ON `bundle` (`company_id`,`die_id`);--> statement-breakpoint
CREATE INDEX `bundle_company_server_seq_idx` ON `bundle` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `bundle_group` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`die_id` text NOT NULL,
	`unit` text NOT NULL,
	`purchase_order_ref` text,
	`notes` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`die_id`) REFERENCES `die`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `bundle_group_company_die_idx` ON `bundle_group` (`company_id`,`die_id`);--> statement-breakpoint
CREATE INDEX `bundle_group_company_server_seq_idx` ON `bundle_group` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `bundle_status_event` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`bundle_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`reason` text,
	`actor_id` text,
	`dispatch_id` text,
	`at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bundle_id`) REFERENCES `bundle`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `bundle_status_event_company_bundle_idx` ON `bundle_status_event` (`company_id`,`bundle_id`,`at`);--> statement-breakpoint
CREATE TABLE `packing_list` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`dispatch_id` text NOT NULL,
	`code` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dispatch_id`) REFERENCES `dispatch`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `packing_list_dispatch_unique` ON `packing_list` (`dispatch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `packing_list_company_code_unique` ON `packing_list` (`company_id`,`code`);--> statement-breakpoint
CREATE INDEX `packing_list_company_server_seq_idx` ON `packing_list` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `packing_list_line` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`packing_list_id` text NOT NULL,
	`bundle_id` text NOT NULL,
	`die_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`weight_g` integer NOT NULL,
	`length_mm` integer NOT NULL,
	`group_label` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`packing_list_id`) REFERENCES `packing_list`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bundle_id`) REFERENCES `bundle`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`die_id`) REFERENCES `die`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `packing_list_line_company_list_idx` ON `packing_list_line` (`company_id`,`packing_list_id`);--> statement-breakpoint
CREATE TABLE `label_template` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'bundle' NOT NULL,
	`schema` text NOT NULL,
	`variables` text DEFAULT '{}' NOT NULL,
	`spool_template_id` text,
	`spool_pushed_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `label_template_company_name_unique` ON `label_template` (`company_id`,`name`);--> statement-breakpoint
CREATE INDEX `label_template_company_seq_idx` ON `label_template` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `print_log` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`bundle_id` text,
	`template_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`requested_by` text,
	`spool_job_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`payload_hash` text,
	`response_text` text,
	`attempt` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bundle_id`) REFERENCES `bundle`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`template_id`) REFERENCES `label_template`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`profile_id`) REFERENCES `printer_profile`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`requested_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `print_log_company_created_idx` ON `print_log` (`company_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `print_log_company_spool_job_idx` ON `print_log` (`company_id`,`spool_job_id`);--> statement-breakpoint
CREATE INDEX `print_log_company_status_idx` ON `print_log` (`company_id`,`status`);--> statement-breakpoint
CREATE TABLE `printer_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`spool_printer_id` text NOT NULL,
	`template_id` text NOT NULL,
	`default_copies` integer DEFAULT 1 NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `label_template`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `printer_profile_company_name_unique` ON `printer_profile` (`company_id`,`name`);--> statement-breakpoint
CREATE INDEX `printer_profile_company_seq_idx` ON `printer_profile` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `company_sequence` (
	`company_id` text PRIMARY KEY NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `device` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`user_id` text NOT NULL,
	`platform` text NOT NULL,
	`os_version` text,
	`app_version` text,
	`install_id` text NOT NULL,
	`push_token` text,
	`last_seen_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_company_install_unique` ON `device` (`company_id`,`install_id`);--> statement-breakpoint
CREATE INDEX `device_company_user_idx` ON `device` (`company_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `mutation` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`device_id` text NOT NULL,
	`client_mutation_id` text NOT NULL,
	`entity` text NOT NULL,
	`op` text NOT NULL,
	`payload` text NOT NULL,
	`result` text NOT NULL,
	`error_code` text,
	`applied_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mutation_idempotency_unique` ON `mutation` (`company_id`,`device_id`,`client_mutation_id`);--> statement-breakpoint
CREATE INDEX `mutation_company_applied_idx` ON `mutation` (`company_id`,`applied_at`);--> statement-breakpoint
CREATE TABLE `company` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`audit_retention_days` integer DEFAULT 180 NOT NULL,
	`spool_base_url` text,
	`spool_api_key_wrapped` text,
	`plan` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_slug_unique` ON `company` (`slug`);--> statement-breakpoint
CREATE INDEX `company_status_idx` ON `company` (`status`);--> statement-breakpoint
CREATE TABLE `invite` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`revoked_at` integer,
	`invited_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_token_hash_unique` ON `invite` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invite_company_idx` ON `invite` (`company_id`);--> statement-breakpoint
CREATE INDEX `invite_email_idx` ON `invite` (`email`);--> statement-breakpoint
CREATE TABLE `membership` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`company_id` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `membership_user_unique` ON `membership` (`user_id`);--> statement-breakpoint
CREATE INDEX `membership_company_idx` ON `membership` (`company_id`);--> statement-breakpoint
CREATE TABLE `platform_admin` (
	`user_id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `waitlist_request` (
	`id` text PRIMARY KEY NOT NULL,
	`company_name` text NOT NULL,
	`requester_name` text NOT NULL,
	`requester_email` text NOT NULL,
	`notes` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`reviewed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `waitlist_status_idx` ON `waitlist_request` (`status`,`created_at`);