CREATE TABLE `die_instance` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`section_id` text NOT NULL,
	`seq_no` integer NOT NULL,
	`code` text NOT NULL,
	`supplier` text,
	`trial_kg_per_12ft_milli` integer,
	`hardness` integer,
	`life_g` integer,
	`ftr` text,
	`status` text DEFAULT 'available' NOT NULL,
	`tier_rank` integer,
	`tier_since` integer,
	`notes` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`section_id`) REFERENCES `die`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `die_instance_section_seq_unique` ON `die_instance` (`company_id`,`section_id`,`seq_no`);--> statement-breakpoint
CREATE INDEX `die_instance_company_code_idx` ON `die_instance` (`company_id`,`code`);--> statement-breakpoint
CREATE INDEX `die_instance_company_status_idx` ON `die_instance` (`company_id`,`status`);--> statement-breakpoint
CREATE INDEX `die_instance_company_server_seq_idx` ON `die_instance` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `die_tier_change` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`die_instance_id` text NOT NULL,
	`from_rank` integer,
	`to_rank` integer NOT NULL,
	`reason` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`approval_id` text,
	`effective_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`die_instance_id`) REFERENCES `die_instance`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `die_tier_change_instance_idx` ON `die_tier_change` (`company_id`,`die_instance_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `die_tier_change_company_server_seq_idx` ON `die_tier_change` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `die_tier_change_pending_unique` ON `die_tier_change` (`die_instance_id`) WHERE "die_tier_change"."status" = 'pending';--> statement-breakpoint
CREATE TABLE `die_weight_reading` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`die_instance_id` text NOT NULL,
	`press_run_id` text,
	`kg_per_12ft_milli` integer NOT NULL,
	`last_kg_per_12ft_milli` integer,
	`read_at` integer NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`die_instance_id`) REFERENCES `die_instance`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `die_weight_reading_instance_idx` ON `die_weight_reading` (`company_id`,`die_instance_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `die_weight_reading_company_server_seq_idx` ON `die_weight_reading` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `nitriding_log` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`die_instance_id` text NOT NULL,
	`nitrided_at` integer NOT NULL,
	`hardness` integer,
	`cr4_open_g` integer,
	`cr4_used_g` integer,
	`cr4_close_g` integer,
	`cr2_open_g` integer,
	`cr2_used_g` integer,
	`cr2_close_g` integer,
	`k2s_open_g` integer,
	`k2s_used_g` integer,
	`k2s_close_g` integer,
	`caustic_open_g` integer,
	`caustic_used_g` integer,
	`caustic_close_g` integer,
	`store_txn_id` text,
	`notes` text,
	`signed_by` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`die_instance_id`) REFERENCES `die_instance`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`signed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `nitriding_log_instance_idx` ON `nitriding_log` (`company_id`,`die_instance_id`,`nitrided_at`);--> statement-breakpoint
CREATE INDEX `nitriding_log_company_server_seq_idx` ON `nitriding_log` (`company_id`,`server_seq`);