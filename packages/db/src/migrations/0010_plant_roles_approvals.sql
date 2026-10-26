CREATE TABLE `approval` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`request_note` text,
	`meta` text DEFAULT '{}' NOT NULL,
	`requested_by` text,
	`decided_by` text,
	`decided_at` integer,
	`note` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`decided_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `approval_company_status_idx` ON `approval` (`company_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `approval_company_subject_idx` ON `approval` (`company_id`,`kind`,`subject_id`);--> statement-breakpoint
CREATE INDEX `approval_company_server_seq_idx` ON `approval` (`company_id`,`server_seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `approval_company_pending_unique` ON `approval` (`company_id`,`kind`,`subject_id`) WHERE "approval"."status" = 'pending';--> statement-breakpoint
DROP INDEX `membership_user_unique`;--> statement-breakpoint
ALTER TABLE `membership` ADD `last_active_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `membership_user_company_unique` ON `membership` (`user_id`,`company_id`);