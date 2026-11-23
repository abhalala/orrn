CREATE TABLE `complaint` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`number` text NOT NULL,
	`period` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`source` text NOT NULL,
	`kind` text NOT NULL,
	`bundle_id` text NOT NULL,
	`customer_id` text,
	`dispatch_id` text,
	`description` text NOT NULL,
	`affected_pcs` integer,
	`trace_json` text,
	`reply` text,
	`replied_at` integer,
	`replied_by` text,
	`root_cause` text,
	`corrective_action` text,
	`action_owner_id` text,
	`action_due` text,
	`action_done_at` integer,
	`investigated_by` text,
	`investigated_at` integer,
	`closed_at` integer,
	`closed_by` text,
	`close_note` text,
	`portal_user_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customer`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`replied_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`action_owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`investigated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`closed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `complaint_company_number_unique` ON `complaint` (`company_id`,`period`,`number`);--> statement-breakpoint
CREATE INDEX `complaint_company_status_idx` ON `complaint` (`company_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `complaint_company_bundle_idx` ON `complaint` (`company_id`,`bundle_id`);--> statement-breakpoint
CREATE INDEX `complaint_company_customer_idx` ON `complaint` (`company_id`,`customer_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `bundle` ADD `recut_reason` text;