CREATE TABLE `impersonation_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`platform_admin_id` text NOT NULL,
	`company_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`reason` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`platform_admin_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `impersonation_grant_admin_expires_idx` ON `impersonation_grant` (`platform_admin_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `impersonation_grant_company_idx` ON `impersonation_grant` (`company_id`);