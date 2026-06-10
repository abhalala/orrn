ALTER TABLE `spool_deployment` ADD `node_name` text DEFAULT 'Primary edge node' NOT NULL;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `site_label` text DEFAULT 'Main facility' NOT NULL;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `runtime_flavor` text DEFAULT 'native' NOT NULL;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `runtime_platform` text;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `capabilities` text DEFAULT '["catalog.read","customer.read","bundle.read","bundle.create","bundle.transition","dispatch.add_bundle","print.queue"]' NOT NULL;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `fingerprint` text;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `enrollment_token_hash` text;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `enrollment_issued_at` integer;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `last_sync_at` integer;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `last_sync_cursor` integer;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `last_error_code` text;--> statement-breakpoint
ALTER TABLE `spool_deployment` ADD `last_error_message` text;--> statement-breakpoint
CREATE INDEX `spool_deployment_company_site_idx` ON `spool_deployment` (`company_id`,`site_label`);