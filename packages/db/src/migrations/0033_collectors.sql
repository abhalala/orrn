CREATE TABLE `press_alert` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`press_line_id` text NOT NULL,
	`press_run_id` text,
	`node_id` text,
	`metric` text NOT NULL,
	`direction` text NOT NULL,
	`limit_x10` integer NOT NULL,
	`peak_x10` integer NOT NULL,
	`frames` integer DEFAULT 1 NOT NULL,
	`simulated` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`last_at` integer NOT NULL,
	`ended_at` integer,
	`acknowledged_at` integer,
	`acknowledged_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`press_line_id`) REFERENCES `press_line`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`press_run_id`) REFERENCES `press_run`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`node_id`) REFERENCES `spool_deployment`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`acknowledged_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `press_alert_open_unique` ON `press_alert` (`company_id`,`press_line_id`,`metric`) WHERE "press_alert"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX `press_alert_company_started_idx` ON `press_alert` (`company_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `press_alert_company_run_idx` ON `press_alert` (`company_id`,`press_run_id`);--> statement-breakpoint
CREATE TABLE `press_alert_threshold` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`press_line_id` text,
	`metric` text NOT NULL,
	`min_x10` integer,
	`max_x10` integer,
	`active` integer DEFAULT 1 NOT NULL,
	`updated_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`press_line_id`) REFERENCES `press_line`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `press_alert_threshold_line_metric_unique` ON `press_alert_threshold` (`company_id`,`press_line_id`,`metric`) WHERE "press_alert_threshold"."press_line_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `press_alert_threshold_all_metric_unique` ON `press_alert_threshold` (`company_id`,`metric`) WHERE "press_alert_threshold"."press_line_id" IS NULL;--> statement-breakpoint
CREATE TABLE `press_collector_frame` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`node_id` text NOT NULL,
	`seq` integer NOT NULL,
	`press_line_id` text NOT NULL,
	`press_run_id` text,
	`sampled_at` integer NOT NULL,
	`received_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`simulated` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'unknown' NOT NULL,
	`ram_speed_x10` integer,
	`billet_temp_x10` integer,
	`exit_temp_x10` integer,
	`container_temp_x10` integer,
	`pressure_x10` integer,
	`outlet_pressure_x10` integer,
	`extrusion_ms` integer,
	`billets_total` integer,
	`billet_g_total` integer,
	`fault_code` text,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_id`) REFERENCES `spool_deployment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`press_line_id`) REFERENCES `press_line`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`press_run_id`) REFERENCES `press_run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `press_collector_frame_node_seq_unique` ON `press_collector_frame` (`node_id`,`seq`);--> statement-breakpoint
CREATE INDEX `press_collector_frame_company_run_idx` ON `press_collector_frame` (`company_id`,`press_run_id`);--> statement-breakpoint
CREATE INDEX `press_collector_frame_company_line_at_idx` ON `press_collector_frame` (`company_id`,`press_line_id`,`sampled_at`);--> statement-breakpoint
CREATE TABLE `press_run_collector` (
	`press_run_id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`press_line_id` text NOT NULL,
	`frames` integer DEFAULT 0 NOT NULL,
	`simulated` integer DEFAULT 0 NOT NULL,
	`first_frame_at` integer,
	`last_frame_at` integer,
	`extruding_frames` integer DEFAULT 0 NOT NULL,
	`ram_speed_avg_x10` integer,
	`ram_speed_max_x10` integer,
	`billet_temp_avg_x10` integer,
	`exit_temp_max_x10` integer,
	`pressure_max_x10` integer,
	`billets_counted` integer,
	`collector_input_g` integer,
	`typed_input_g` integer,
	`variance_basis` text,
	`variance_bp` integer,
	`collector_variance` integer DEFAULT 0 NOT NULL,
	`evaluated_at` integer NOT NULL,
	FOREIGN KEY (`press_run_id`) REFERENCES `press_run`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`press_line_id`) REFERENCES `press_line`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `press_run_collector_company_line_idx` ON `press_run_collector` (`company_id`,`press_line_id`);--> statement-breakpoint
CREATE INDEX `press_run_collector_company_variance_idx` ON `press_run_collector` (`company_id`,`collector_variance`);--> statement-breakpoint
CREATE TABLE `spectro_inbox` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`node_id` text,
	`sha256` text NOT NULL,
	`file_name` text NOT NULL,
	`mime` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`file_key` text NOT NULL,
	`status` text DEFAULT 'uploading' NOT NULL,
	`simulated` integer DEFAULT 0 NOT NULL,
	`captured_at` integer,
	`sample_ref` text,
	`instrument` text,
	`values_ppm` text,
	`uploaded_at` integer,
	`melt_id` text,
	`spectro_result_id` text,
	`reviewed_by` text,
	`reviewed_at` integer,
	`dismiss_reason` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_id`) REFERENCES `spool_deployment`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`melt_id`) REFERENCES `melt`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`spectro_result_id`) REFERENCES `spectro_result`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `spectro_inbox_company_sha_unique` ON `spectro_inbox` (`company_id`,`sha256`);--> statement-breakpoint
CREATE INDEX `spectro_inbox_company_status_idx` ON `spectro_inbox` (`company_id`,`status`);--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `collectors` text;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `collectors_reported_at` integer;