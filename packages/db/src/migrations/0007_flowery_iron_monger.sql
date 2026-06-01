CREATE TABLE `spool_deployment` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`instance_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`subdomain` text NOT NULL,
	`spool_domain` text NOT NULL,
	`cf_tunnel_id` text,
	`cf_tunnel_token_wrapped` text NOT NULL,
	`shared_secret_hash` text NOT NULL,
	`shared_secret_wrapped` text NOT NULL,
	`spool_version` text,
	`last_seen_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `spool_deployment_instance_id_unique` ON `spool_deployment` (`instance_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `spool_deployment_subdomain_unique` ON `spool_deployment` (`subdomain`);--> statement-breakpoint
CREATE UNIQUE INDEX `spool_deployment_spool_domain_unique` ON `spool_deployment` (`spool_domain`);--> statement-breakpoint
CREATE INDEX `spool_deployment_company_idx` ON `spool_deployment` (`company_id`);--> statement-breakpoint
CREATE INDEX `spool_deployment_company_status_idx` ON `spool_deployment` (`company_id`,`status`);