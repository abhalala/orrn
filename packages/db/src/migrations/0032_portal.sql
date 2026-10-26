CREATE TABLE `customer_portal_section` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`customer_id` text NOT NULL,
	`die_id` text NOT NULL,
	`granted_by` text,
	`granted_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`revoked_at` integer,
	`revoked_by` text,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customer`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`die_id`) REFERENCES `die`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`granted_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`revoked_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_portal_section_live_unique` ON `customer_portal_section` (`company_id`,`customer_id`,`die_id`) WHERE "customer_portal_section"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX `customer_portal_section_company_customer_idx` ON `customer_portal_section` (`company_id`,`customer_id`);--> statement-breakpoint
CREATE TABLE `customer_portal_user` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`customer_id` text NOT NULL,
	`email` text NOT NULL,
	`user_id` text,
	`status` text DEFAULT 'invited' NOT NULL,
	`invite_id` text,
	`invited_at` integer,
	`invited_by` text,
	`accepted_at` integer,
	`revoked_at` integer,
	`revoked_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customer`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invite_id`) REFERENCES `invite`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`invited_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`revoked_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_portal_user_company_email_unique` ON `customer_portal_user` (`company_id`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `customer_portal_user_company_user_unique` ON `customer_portal_user` (`company_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `customer_portal_user_company_customer_idx` ON `customer_portal_user` (`company_id`,`customer_id`,`status`);--> statement-breakpoint
CREATE INDEX `customer_portal_user_user_idx` ON `customer_portal_user` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `test_certificate` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`dispatch_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`packing_list_id` text,
	`period` text NOT NULL,
	`number` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`supersedes_id` text,
	`chemistry` text DEFAULT 'pending' NOT NULL,
	`snapshot` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dispatch_id`) REFERENCES `dispatch`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`customer_id`) REFERENCES `customer`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `test_certificate_company_number_revision_unique` ON `test_certificate` (`company_id`,`number`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `test_certificate_company_dispatch_revision_unique` ON `test_certificate` (`company_id`,`dispatch_id`,`revision`);--> statement-breakpoint
CREATE INDEX `test_certificate_company_customer_idx` ON `test_certificate` (`company_id`,`customer_id`);--> statement-breakpoint
ALTER TABLE `invite` ADD `kind` text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE `invite` ADD `customer_id` text;