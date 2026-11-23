-- XE PLATFORM (lane PLATFORM, reserved 0066): custom roles, plant API tokens and their rate counter, webhook endpoints and
-- the webhook outbox. Additive: six new tables, no existing table changed. `api` is an opt-in module; with no custom
-- role made nothing here is read for permissions beyond one LEFT JOIN that finds no row.

CREATE TABLE `api_rate` (
	`token_id` text NOT NULL,
	`minute` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`token_id`, `minute`),
	FOREIGN KEY (`token_id`) REFERENCES `api_token`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `api_token` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`name` text NOT NULL,
	`scopes` text DEFAULT '[]' NOT NULL,
	`salt` text NOT NULL,
	`token_hash` text NOT NULL,
	`hint` text NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`last_used_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `api_token_company_idx` ON `api_token` (`company_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `custom_role` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`base_role` text NOT NULL,
	`added` text DEFAULT '[]' NOT NULL,
	`removed` text DEFAULT '[]' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_role_company_name_idx` ON `custom_role` (`company_id`,`name_key`);--> statement-breakpoint
CREATE INDEX `custom_role_company_idx` ON `custom_role` (`company_id`,`id`);--> statement-breakpoint
CREATE TABLE `membership_custom_role` (
	`membership_id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`custom_role_id` text NOT NULL,
	`assigned_by` text,
	`assigned_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`membership_id`) REFERENCES `membership`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`custom_role_id`) REFERENCES `custom_role`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assigned_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `membership_custom_role_role_idx` ON `membership_custom_role` (`company_id`,`custom_role_id`);--> statement-breakpoint
CREATE TABLE `webhook_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`endpoint_id` text NOT NULL,
	`event` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`claimed_until` integer,
	`last_status` integer,
	`last_error` text,
	`delivered_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`endpoint_id`) REFERENCES `webhook_endpoint`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_delivery_due_idx` ON `webhook_delivery` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `webhook_delivery_company_idx` ON `webhook_delivery` (`company_id`,`endpoint_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `webhook_endpoint` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`url` text NOT NULL,
	`events` text DEFAULT '[]' NOT NULL,
	`secret_wrapped` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `webhook_endpoint_company_idx` ON `webhook_endpoint` (`company_id`,`active`);