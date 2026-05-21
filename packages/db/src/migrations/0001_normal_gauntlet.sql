ALTER TABLE `bundle_group` ADD `code` text;--> statement-breakpoint
UPDATE `bundle_group` SET `code` = 'BG-' || printf('%06d', `server_seq`) WHERE `code` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `bundle_group_company_code_unique` ON `bundle_group` (`company_id`,`code`);--> statement-breakpoint
CREATE INDEX `bundle_group_company_created_idx` ON `bundle_group` (`company_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `bundle_company_group_idx` ON `bundle` (`company_id`,`group_id`);--> statement-breakpoint
CREATE INDEX `bundle_company_status_die_idx` ON `bundle` (`company_id`,`status`,`die_id`);
