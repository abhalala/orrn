CREATE TABLE `edge_command` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`deployment_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`job_key` text,
	`payload_hash` text,
	`print_log_id` text,
	`state` text DEFAULT 'queued' NOT NULL,
	`lease_id` text,
	`lease_expires_at` integer,
	`delivery_count` integer DEFAULT 0 NOT NULL,
	`resolved_at` integer,
	`resolution_json` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deployment_id`) REFERENCES `spool_deployment`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `edge_command_deployment_state_idx` ON `edge_command` (`deployment_id`,`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `edge_command_company_job_key_idx` ON `edge_command` (`company_id`,`job_key`);--> statement-breakpoint
CREATE TABLE `edge_event_receipt` (
	`event_id` text NOT NULL,
	`deployment_id` text NOT NULL,
	`company_id` text NOT NULL,
	`kind` text NOT NULL,
	`response_json` text NOT NULL,
	`received_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`deployment_id`) REFERENCES `spool_deployment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `edge_event_receipt_deployment_event_unique` ON `edge_event_receipt` (`deployment_id`,`event_id`);--> statement-breakpoint
CREATE TABLE `edge_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`section` text NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`content_sha256` text NOT NULL,
	`record_count` integer DEFAULT 0 NOT NULL,
	`chunk_count` integer DEFAULT 1 NOT NULL,
	`complete` integer DEFAULT false NOT NULL,
	`generated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `edge_snapshot_company_section_idx` ON `edge_snapshot` (`company_id`,`section`,`generated_at`);--> statement-breakpoint
CREATE TABLE `edge_snapshot_chunk` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`company_id` text NOT NULL,
	`section` text NOT NULL,
	`sequence` integer NOT NULL,
	`sha256` text NOT NULL,
	`record_count` integer DEFAULT 0 NOT NULL,
	`byte_length` integer DEFAULT 0 NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `edge_snapshot`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `edge_snapshot_chunk_snapshot_seq_unique` ON `edge_snapshot_chunk` (`snapshot_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `edge_snapshot_chunk_company_section_idx` ON `edge_snapshot_chunk` (`company_id`,`section`);--> statement-breakpoint
ALTER TABLE `print_log` ADD `deployment_id` text;--> statement-breakpoint
ALTER TABLE `print_log` ADD `copies` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `print_log` ADD `command_id` text;--> statement-breakpoint
ALTER TABLE `printer_profile` ADD `deployment_id` text;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `enrollment_expires_at` integer;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `enrollment_used_at` integer;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `install_id` text;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `credential_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `pending_credential_version` integer;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `pending_secret_hash` text;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `pending_secret_wrapped` text;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `config_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `applied_config_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `reported_printers` text;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `desired_printers` text;