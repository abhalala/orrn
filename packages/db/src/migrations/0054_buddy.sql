-- orrn buddy (design 2026-11-18, §13): buddy_link, buddy_grant, buddy_call, buddy_draft. Additive, four new tables.
-- Numbered 0054 after main's 0053_ingest_model_checked_by (release 2, decision D30); snapshot regenerated at the rebase.

CREATE TABLE `buddy_call` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`user_id` text NOT NULL,
	`grant_id` text,
	`tool` text NOT NULL,
	`path` text,
	`outcome` text NOT NULL,
	`ms` integer DEFAULT 0 NOT NULL,
	`result_bytes` integer DEFAULT 0 NOT NULL,
	`platform` text,
	`at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`grant_id`) REFERENCES `buddy_grant`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `buddy_call_company_at_idx` ON `buddy_call` (`company_id`,`at`);--> statement-breakpoint
CREATE INDEX `buddy_call_grant_at_idx` ON `buddy_call` (`grant_id`,`at`);--> statement-breakpoint
CREATE INDEX `buddy_call_company_user_tool_at_idx` ON `buddy_call` (`company_id`,`user_id`,`tool`,`at`);--> statement-breakpoint
CREATE TABLE `buddy_draft` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`requested_by_user_id` text NOT NULL,
	`grant_id` text,
	`path` text NOT NULL,
	`input_json` text,
	`summary` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	`claimed_at` integer,
	`decided_by` text,
	`decided_at` integer,
	`result_json` text,
	`failure` text,
	`origin_platform` text,
	`decided_via` text,
	`noted_at` integer,
	`kind` text DEFAULT 'procedure' NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`grant_id`) REFERENCES `buddy_grant`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`decided_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `buddy_draft_company_user_status_idx` ON `buddy_draft` (`company_id`,`requested_by_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `buddy_draft_grant_created_idx` ON `buddy_draft` (`grant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `buddy_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`scopes` text DEFAULT '[]' NOT NULL,
	`sign_in_method` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`revoked_reason` text,
	`last_used_at` integer,
	`renewed_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `buddy_grant_token_hash_unique` ON `buddy_grant` (`token_hash`);--> statement-breakpoint
CREATE INDEX `buddy_grant_company_user_idx` ON `buddy_grant` (`company_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `buddy_link` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`user_id` text NOT NULL,
	`hermes_profile` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `buddy_link_company_user_idx` ON `buddy_link` (`company_id`,`user_id`,`status`);
