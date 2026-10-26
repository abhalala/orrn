-- FP-DR-20: die share link. Additive only. Written as 0040, renumbered to 0037 by MERGER-12 (after 0036_foundry); prevId = 0036 snapshot b2c4af85.
CREATE TABLE `die_share` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`section_id` text NOT NULL,
	`customer_id` text,
	`token_hash` text NOT NULL,
	`note` text,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`revoked_by` text,
	`view_count` integer DEFAULT 0 NOT NULL,
	`last_viewed_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`section_id`) REFERENCES `die`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customer`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revoked_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `die_share_token_hash_unique` ON `die_share` (`token_hash`);--> statement-breakpoint
CREATE INDEX `die_share_company_section_idx` ON `die_share` (`company_id`,`section_id`,`created_at`);