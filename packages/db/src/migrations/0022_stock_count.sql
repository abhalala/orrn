CREATE TABLE `count_line` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`bundle_id` text,
	`seen_id` text,
	`code` text,
	`system_location_id` text,
	`seen_location_id` text,
	`bundle_status` text,
	`weight_g` integer,
	`resolution` text DEFAULT 'open' NOT NULL,
	`approval_id` text,
	`resolved_at` integer,
	`resolved_by` text,
	`resolution_voucher_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `count_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bundle_id`) REFERENCES `bundle`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`seen_id`) REFERENCES `count_seen`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`system_location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`seen_location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`resolved_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `count_line_session_bundle_unique` ON `count_line` (`company_id`,`session_id`,`bundle_id`) WHERE "count_line"."bundle_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `count_line_session_seen_unique` ON `count_line` (`company_id`,`session_id`,`seen_id`) WHERE "count_line"."seen_id" is not null;--> statement-breakpoint
CREATE INDEX `count_line_company_session_kind_idx` ON `count_line` (`company_id`,`session_id`,`kind`);--> statement-breakpoint
CREATE INDEX `count_line_company_approval_idx` ON `count_line` (`company_id`,`approval_id`);--> statement-breakpoint
CREATE INDEX `count_line_company_bundle_idx` ON `count_line` (`company_id`,`bundle_id`);--> statement-breakpoint
CREATE INDEX `count_line_company_server_seq_idx` ON `count_line` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `count_location` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`session_id` text NOT NULL,
	`location_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `count_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `count_location_session_location_unique` ON `count_location` (`company_id`,`session_id`,`location_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `count_location_company_open_unique` ON `count_location` (`company_id`,`location_id`) WHERE "count_location"."status" = 'open';--> statement-breakpoint
CREATE INDEX `count_location_company_location_idx` ON `count_location` (`company_id`,`location_id`,`status`);--> statement-breakpoint
CREATE INDEX `count_location_company_server_seq_idx` ON `count_location` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `count_seen` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`session_id` text NOT NULL,
	`location_id` text NOT NULL,
	`code` text NOT NULL,
	`resolve_kind` text NOT NULL,
	`bundle_id` text,
	`scanned_at` integer NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `count_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`bundle_id`) REFERENCES `bundle`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `count_seen_session_code_unique` ON `count_seen` (`company_id`,`session_id`,`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `count_seen_session_bundle_unique` ON `count_seen` (`company_id`,`session_id`,`bundle_id`) WHERE "count_seen"."bundle_id" is not null;--> statement-breakpoint
CREATE INDEX `count_seen_company_bundle_idx` ON `count_seen` (`company_id`,`bundle_id`);--> statement-breakpoint
CREATE INDEX `count_seen_company_server_seq_idx` ON `count_seen` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `count_session` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`number` text NOT NULL,
	`period` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`start_seq` integer NOT NULL,
	`include_unplaced` integer DEFAULT false NOT NULL,
	`note` text,
	`closed_at` integer,
	`closed_by` text,
	`close_seq` integer,
	`expected_count` integer,
	`seen_count` integer,
	`phantom_count` integer,
	`phantom_g` integer,
	`found_count` integer,
	`moved_count` integer,
	`changed_count` integer,
	`seen_elsewhere_count` integer,
	`cancelled_at` integer,
	`cancelled_by` text,
	`cancel_reason` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`closed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cancelled_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `count_session_company_number_unique` ON `count_session` (`company_id`,`period`,`number`);--> statement-breakpoint
CREATE INDEX `count_session_company_status_idx` ON `count_session` (`company_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `count_session_company_server_seq_idx` ON `count_session` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `count_tally` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`session_id` text NOT NULL,
	`location_id` text,
	`die_id` text,
	`expected_count` integer NOT NULL,
	`expected_g` integer NOT NULL,
	`counted_count` integer NOT NULL,
	`counted_g` integer NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `count_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`die_id`) REFERENCES `die`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `count_tally_company_session_idx` ON `count_tally` (`company_id`,`session_id`);--> statement-breakpoint
CREATE INDEX `count_tally_company_server_seq_idx` ON `count_tally` (`company_id`,`server_seq`);